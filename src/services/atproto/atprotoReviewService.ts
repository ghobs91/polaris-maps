import { getAgent, getBlueskySession, refreshBlueskySession } from './atprotoAuthService';
import type { Review, PlaceReviewContext } from '../../models/review';

const COLLECTION = 'io.polaris.place.review';

export async function publishReviewToAtproto(
  review: Review,
  context: PlaceReviewContext,
): Promise<string> {
  const currentAgent = getAgent();
  if (!currentAgent) {
    throw new Error('Not logged in to Bluesky');
  }

  const session = await getBlueskySession();
  if (!session) {
    throw new Error('No Bluesky session');
  }

  const subject: Record<string, unknown> = {
    poiUuid: context.poiUuid,
    source: context.source,
  };
  if (context.osmId) subject.osmId = context.osmId;
  if (context.overtureId) subject.overtureId = context.overtureId;
  if (context.name) subject.name = context.name;
  if (context.lat !== undefined) subject.lat = context.lat;
  if (context.lng !== undefined) subject.lng = context.lng;

  const record: Record<string, unknown> = {
    $type: COLLECTION,
    subject,
    rating: review.rating,
    createdAt: new Date(review.createdAt * 1000).toISOString(),
  };
  if (review.text) {
    record.text = review.text;
  }

  try {
    const response = await currentAgent.api.com.atproto.repo.createRecord({
      repo: session.did,
      collection: COLLECTION,
      record,
    });
    return response.data.uri;
  } catch (err: unknown) {
    // On 401, try refreshing session once then retry
    const isUnauthorized =
      err instanceof Error &&
      ('status' in err ? (err as Record<string, unknown>).status === 401 : false);

    if (isUnauthorized) {
      await refreshBlueskySession();
      const retryAgent = getAgent();
      const retrySession = await getBlueskySession();
      if (!retryAgent || !retrySession) {
        throw new Error('Session refresh failed');
      }

      const retryResponse = await retryAgent.api.com.atproto.repo.createRecord({
        repo: retrySession.did,
        collection: COLLECTION,
        record,
      });
      return retryResponse.data.uri;
    }

    throw err;
  }
}

interface AtprotoListRecord {
  uri: string;
  value: {
    subject: { poiUuid: string };
    rating: number;
    text?: string;
    createdAt: string;
  };
}

export async function fetchReviewsFromAtproto(poiUuid: string): Promise<Review[]> {
  const currentAgent = getAgent();
  if (!currentAgent) return [];

  const session = await getBlueskySession();
  if (!session) return [];

  try {
    const response = await currentAgent.api.com.atproto.repo.listRecords({
      repo: session.did,
      collection: COLLECTION,
    });

    const records = (response.data.records ?? []) as unknown as AtprotoListRecord[];

    return records
      .filter((r) => r.value?.subject?.poiUuid === poiUuid)
      .map((r) => ({
        id: r.uri,
        poiUuid: r.value.subject.poiUuid,
        authorPubkey: session.did,
        authorHandle: session.handle,
        rating: r.value.rating,
        text: r.value.text,
        signature: '',
        createdAt: Math.floor(new Date(r.value.createdAt).getTime() / 1000),
        updatedAt: Math.floor(new Date(r.value.createdAt).getTime() / 1000),
        source: 'atproto' as const,
        atprotoUri: r.uri,
      }));
  } catch (err) {
    console.warn('Failed to fetch ATProto reviews:', err);
    return [];
  }
}

export async function deleteReviewFromAtproto(recordUri: string): Promise<void> {
  const currentAgent = getAgent();
  if (!currentAgent) {
    throw new Error('Not logged in to Bluesky');
  }

  const session = await getBlueskySession();
  if (!session) {
    throw new Error('No Bluesky session');
  }

  // Parse rkey from at://did:plc:xxx/io.polaris.place.review/rkey
  const parts = recordUri.split('/');
  const rkey = parts[parts.length - 1];

  await currentAgent.api.com.atproto.repo.deleteRecord({
    repo: session.did,
    collection: COLLECTION,
    rkey,
  });
}
