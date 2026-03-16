import { getGun } from '../gun/init';
import { sign, verify, createSigningPayload } from '../identity/signing';
import { getOrCreateKeypair } from '../identity/keypair';
import { recordContribution, recordConfirmation, getReputation } from './reputationService';
import { updatePlace } from './poiService';
import type { DataEdit, DataEditEntityType, DataEditStatus } from '../../models/dataEdit';

export async function submitEdit(
  entityType: DataEditEntityType,
  entityId: string,
  fieldName: string,
  oldValue?: string,
  newValue?: string,
): Promise<DataEdit> {
  const keypair = await getOrCreateKeypair();
  const now = Math.floor(Date.now() / 1000);
  const id = `${entityType}:${entityId}:${now}:${keypair.publicKey}`;

  const payload = createSigningPayload(id, entityId, fieldName, String(now));
  const signature = await sign(payload, keypair.privateKey);

  const edit: DataEdit = {
    id,
    entityType,
    entityId,
    authorPubkey: keypair.publicKey,
    fieldName,
    oldValue,
    newValue,
    status: 'pending',
    corroborations: 0,
    disputes: 0,
    signature,
    createdAt: now,
    resolvedAt: undefined,
  };

  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('edits')
    .get(entityId)
    .get(id)
    .put({
      id: edit.id,
      entity_type: edit.entityType,
      entity_id: edit.entityId,
      author_pubkey: edit.authorPubkey,
      field_name: edit.fieldName,
      old_value: edit.oldValue ?? null,
      new_value: edit.newValue ?? null,
      status: edit.status,
      corroborations: edit.corroborations,
      disputes: edit.disputes,
      signature: edit.signature,
      created_at: edit.createdAt,
      resolved_at: null,
    });

  await recordContribution('edit_submit');
  return edit;
}

export async function corroborateEdit(editId: string, entityId: string): Promise<DataEdit> {
  const edit = await getEditFromGun(editId, entityId);
  if (!edit) throw new Error(`Edit not found: ${editId}`);
  if (edit.status !== 'pending') throw new Error(`Edit is not pending: ${edit.status}`);

  const keypair = await getOrCreateKeypair();
  if (edit.authorPubkey === keypair.publicKey) {
    throw new Error('Cannot corroborate your own edit');
  }

  const updated: DataEdit = {
    ...edit,
    corroborations: edit.corroborations + 1,
  };

  const authorRep = await getReputation(edit.authorPubkey);
  if (updated.corroborations >= 1 && (authorRep?.score ?? 0) >= 20) {
    updated.status = 'accepted';
    updated.resolvedAt = Math.floor(Date.now() / 1000);
    await applyEdit(updated);
  }

  await writeEditToGun(updated);
  await recordContribution('edit_corroborate');
  await recordConfirmation();
  return updated;
}

export async function disputeEdit(editId: string, entityId: string): Promise<DataEdit> {
  const edit = await getEditFromGun(editId, entityId);
  if (!edit) throw new Error(`Edit not found: ${editId}`);
  if (edit.status !== 'pending') throw new Error(`Edit is not pending: ${edit.status}`);

  const keypair = await getOrCreateKeypair();
  if (edit.authorPubkey === keypair.publicKey) {
    throw new Error('Cannot dispute your own edit');
  }

  const updated: DataEdit = {
    ...edit,
    disputes: edit.disputes + 1,
  };

  if (updated.disputes >= 3) {
    updated.status = 'rejected';
    updated.resolvedAt = Math.floor(Date.now() / 1000);
  }

  await writeEditToGun(updated);
  return updated;
}

export async function getPendingEdits(entityId: string): Promise<DataEdit[]> {
  return new Promise((resolve) => {
    const edits: DataEdit[] = [];
    const gun = getGun();
    (gun as any)
      .get('polaris')
      .get('edits')
      .get(entityId)
      .map()
      .once((data: Record<string, unknown> | undefined) => {
        if (data && data.status === 'pending' && isEditSignatureValid(data)) {
          edits.push(gunRecordToEdit(data));
        }
      });
    setTimeout(() => resolve(edits), 500);
  });
}

async function applyEdit(edit: DataEdit): Promise<void> {
  if (edit.entityType === 'place' && edit.fieldName) {
    await updatePlace(edit.entityId, { [edit.fieldName]: edit.newValue });
  }
}

async function getEditFromGun(editId: string, entityId: string): Promise<DataEdit | null> {
  return new Promise((resolve) => {
    const gun = getGun();
    (gun as any)
      .get('polaris')
      .get('edits')
      .get(entityId)
      .get(editId)
      .once((data: Record<string, unknown> | undefined) => {
        if (!data || !data.id || !isEditSignatureValid(data)) {
          resolve(null);
          return;
        }
        resolve(gunRecordToEdit(data));
      });
  });
}

async function writeEditToGun(edit: DataEdit): Promise<void> {
  const gun = getGun();
  (gun as any)
    .get('polaris')
    .get('edits')
    .get(edit.entityId)
    .get(edit.id)
    .put({
      id: edit.id,
      entity_type: edit.entityType,
      entity_id: edit.entityId,
      author_pubkey: edit.authorPubkey,
      field_name: edit.fieldName,
      old_value: edit.oldValue ?? null,
      new_value: edit.newValue ?? null,
      status: edit.status,
      corroborations: edit.corroborations,
      disputes: edit.disputes,
      signature: edit.signature,
      created_at: edit.createdAt,
      resolved_at: edit.resolvedAt ?? null,
    });
}

/**
 * Verify the Schnorr signature on a raw Gun.js edit record before trusting it.
 * Returns false for any record with a missing, invalid, or unverifiable signature.
 * This prevents malicious peers from injecting or tampering with edit records.
 */
function isEditSignatureValid(data: Record<string, unknown>): boolean {
  const sig = (data.signature as string) ?? '';
  const pubkey = (data.author_pubkey as string) ?? '';
  const id = (data.id as string) ?? '';
  const entityId = (data.entity_id as string) ?? '';
  const fieldName = (data.field_name as string) ?? '';
  const createdAt = String((data.created_at as number) ?? 0);
  if (!sig || !pubkey) return false;
  const payload = createSigningPayload(id, entityId, fieldName, createdAt);
  return verify(payload, sig, pubkey);
}

function gunRecordToEdit(data: Record<string, unknown>): DataEdit {
  return {
    id: data.id as string,
    entityType: data.entity_type as DataEditEntityType,
    entityId: data.entity_id as string,
    authorPubkey: data.author_pubkey as string,
    fieldName: data.field_name as string,
    oldValue: (data.old_value as string) ?? undefined,
    newValue: (data.new_value as string) ?? undefined,
    status: data.status as DataEditStatus,
    corroborations: (data.corroborations as number) ?? 0,
    disputes: (data.disputes as number) ?? 0,
    signature: data.signature as string,
    createdAt: data.created_at as number,
    resolvedAt: (data.resolved_at as number) ?? undefined,
  };
}
