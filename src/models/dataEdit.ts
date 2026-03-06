export type DataEditEntityType = 'place' | 'review' | 'road_segment';
export type DataEditStatus = 'pending' | 'accepted' | 'rejected';

export interface DataEdit {
  id: string; // {entity_type}:{entity_id}:{timestamp}:{author_pubkey}
  entityType: DataEditEntityType;
  entityId: string;
  authorPubkey: string;
  fieldName: string;
  oldValue?: string;
  newValue?: string;
  status: DataEditStatus;
  corroborations: number;
  disputes: number;
  signature: string;
  createdAt: number;
  resolvedAt?: number;
}
