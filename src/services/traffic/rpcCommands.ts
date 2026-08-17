/** RPC command IDs shared between the Bare worklet and React Native. */

export const CMD_JOIN_TOPIC = 0;
export const CMD_LEAVE_TOPIC = 1;
export const CMD_PUBLISH_PROBE = 2;
export const CMD_GET_STATUS = 3;
/** RN → worklet: broadcast a traffic condition request to all peers. */
export const CMD_REQUEST_CONDITIONS = 4;
/** RN → worklet: send a condition response to a specific peer connection. */
export const CMD_SEND_CONDITION_RESPONSE = 5;
/** RN → worklet: broadcast a traffic tile request to all peers. */
export const CMD_REQUEST_TILE = 6;
/** RN → worklet: send a tile response to a specific peer connection. */
export const CMD_SEND_TILE_RESPONSE = 7;
export const CMD_INCOMING_PROBE = 10;
export const CMD_PEER_COUNT = 11;
export const CMD_AGGREGATED_UPDATE = 12;
/** worklet → RN: a peer requested traffic conditions for cells/bucket. */
export const CMD_INCOMING_CONDITION_REQUEST = 13;
/** worklet → RN: a peer responded to one of our condition requests. */
export const CMD_INCOMING_CONDITION_RESPONSE = 14;
/** worklet → RN: a peer requested a traffic tile. */
export const CMD_INCOMING_TILE_REQUEST = 15;
/** worklet → RN: a peer responded to one of our tile requests. */
export const CMD_INCOMING_TILE_RESPONSE = 16;
export const CMD_SUSPEND = 20;
export const CMD_RESUME = 21;
