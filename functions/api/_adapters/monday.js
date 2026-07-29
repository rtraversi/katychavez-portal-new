// monday.com GraphQL adapter.
//
// Read-only by design: this module never writes to the board. The portal is downstream
// of monday here, and a sync that could edit the firm's live board is a much bigger
// blast radius than the feature needs.
//
// Secrets, per the house pattern — an unconfigured provider is simply dormant:
//   MONDAY_API_TOKEN   secret. monday.com -> avatar -> Developers -> My access tokens
//   MONDAY_BOARD_ID    var. The board holding the client group.
//   MONDAY_GROUP_ID    var. The group within it that is actually a client list.

const MONDAY_API = 'https://api.monday.com/v2';

// The board columns this module reads. Requesting them by id keeps the response small
// and means a new column on the board cannot change what we parse.
export const COLUMN_IDS = ['phone_number', 'email3__1', 'status_28', 'date3', 'language', 'type', 'status'];

export class MondayAdapter {
  static provider = 'monday';

  static isConfigured(env) {
    return !!env.MONDAY_API_TOKEN && !!env.MONDAY_BOARD_ID && !!env.MONDAY_GROUP_ID;
  }

  constructor(env) {
    this._token = env.MONDAY_API_TOKEN || null;
    this.boardId = env.MONDAY_BOARD_ID || null;
    this.groupId = env.MONDAY_GROUP_ID || null;
    // monday's API is versioned by date; pinning avoids a silent schema change.
    this._version = env.MONDAY_API_VERSION || '2024-10';
  }

  async _query(query, variables = {}) {
    const res = await fetch(MONDAY_API, {
      method: 'POST',
      headers: {
        'Authorization': this._token,
        'Content-Type': 'application/json',
        'API-Version': this._version,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      throw new Error(`monday.com API returned HTTP ${res.status}`);
    }

    const body = await res.json();
    // monday returns 200 with an `errors` array rather than an HTTP error status, so a
    // failed query looks like a success unless this is checked explicitly.
    if (body.errors?.length) {
      throw new Error(`monday.com API error: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    return body.data;
  }

  /**
   * Fetch every item in the configured group, following cursor pagination.
   *
   * Returns flat objects — `{ id, name, phone, email, caseCode, dateHired, language,
   * type, status }` — so nothing downstream has to know monday's column-value shape.
   */
  async fetchGroupItems({ pageLimit = 200, maxPages = 20 } = {}) {
    const items = [];
    let cursor = null;
    let page = 0;

    do {
      // First page reads through the group; subsequent pages use next_items_page, which
      // takes only the cursor.
      const data = cursor
        ? await this._query(
            `query ($cursor: String!, $limit: Int!, $cols: [String!]) {
               next_items_page(cursor: $cursor, limit: $limit) {
                 cursor
                 items { id name column_values(ids: $cols) { id text } }
               }
             }`,
            { cursor, limit: pageLimit, cols: COLUMN_IDS },
          )
        : await this._query(
            `query ($board: [ID!], $group: [String!], $limit: Int!, $cols: [String!]) {
               boards(ids: $board) {
                 groups(ids: $group) {
                   items_page(limit: $limit) {
                     cursor
                     items { id name column_values(ids: $cols) { id text } }
                   }
                 }
               }
             }`,
            { board: [this.boardId], group: [this.groupId], limit: pageLimit, cols: COLUMN_IDS },
          );

      const pageData = cursor
        ? data?.next_items_page
        : data?.boards?.[0]?.groups?.[0]?.items_page;

      if (!pageData) {
        if (!cursor) throw new Error(`Board ${this.boardId} or group ${this.groupId} not found`);
        break;
      }

      for (const it of pageData.items || []) items.push(toFlatItem(it));
      cursor = pageData.cursor || null;
      page += 1;
    } while (cursor && page < maxPages);

    if (cursor) {
      // Rather than silently returning a partial list — which would read as "these are
      // all the clients" and quietly hide the rest.
      throw new Error(`Group has more than ${maxPages * pageLimit} items; refusing to return a partial list`);
    }

    return items;
  }
}

/** Flatten one monday item's column_values into named fields. */
export function toFlatItem(item) {
  const col = {};
  for (const cv of item.column_values || []) col[cv.id] = cv.text ?? '';
  return {
    id: String(item.id),
    name: item.name || '',
    phone: col.phone_number || '',
    email: col.email3__1 || '',
    caseCode: col.status_28 || '',
    dateHired: col.date3 || '',
    language: col.language || '',
    type: col.type || '',
    status: col.status || '',
  };
}
