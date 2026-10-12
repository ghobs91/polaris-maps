import { getAgent, getBlueskySession } from './atprotoAuthService';
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

  // The OAuth-based agent handles token refresh automatically. If a 401
  // still bubbles up, the session is dead and the user must re-authenticate.
  const response = await currentAgent.api.com.atproto.repo.createRecord({
    repo: session.did,
    collection: COLLECTION,
    record,
  });
  return response.data.uri;
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

// `com.atproto.repo.listRecords` is paginated: the lexicon default is 50
// records with a max of 100, and `cursor` must be followed to read the rest.
// Without a limit here the server silently truncates to that page, so a review
// that lands beyond page one is dropped from every place view.
const LIST_RECORDS_LIMIT = 100;
// Defensive cap so a malformed/looping cursor can never spin forever
// (200 × 100 = 20k records, far above any realistic personal collection).
const LIST_RECORDS_MAX_PAGES = 200;

function toReview(record: AtprotoListRecord, session: { did: string; handle: string }): Review {
  const createdAt = Math.floor(new Date(record.value.createdAt).getTime() / 1000);
  return {
    id: record.uri,
    poiUuid: record.value.subject.poiUuid,
    authorPubkey: session.did,
    authorHandle: session.handle,
    rating: record.value.rating,
    text: record.value.text,
    signature: '',
    createdAt,
    updatedAt: createdAt,
    source: 'atproto',
    atprotoUri: record.uri,
  };
}

export async function fetchReviewsFromAtproto(poiUuid: string): Promise<Review[]> {
  const currentAgent = getAgent();
  if (!currentAgent) return [];

  const session = await getBlueskySession();
  if (!session) return [];

  try {
    const reviews: Review[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < LIST_RECORDS_MAX_PAGES; page++) {
      const response = await currentAgent.api.com.atproto.repo.listRecords({
        repo: session.did,
        collection: COLLECTION,
        limit: LIST_RECORDS_LIMIT,
        ...(cursor ? { cursor } : {}),
      });

      const records = (response.data.records ?? []) as unknown as AtprotoListRecord[];
      for (const record of records) {
        if (record.value?.subject?.poiUuid === poiUuid) reviews.push(toReview(record, session));
      }

      cursor = response.data.cursor;
      if (!cursor || records.length === 0) break;
    }

    return reviews;
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
