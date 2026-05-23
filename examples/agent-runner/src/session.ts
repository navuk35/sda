/**
 * session.ts — Session streaming to SurrealDB (surrealdb.js v2).
 */

import { Surreal } from "surrealdb";

export interface SessionStoreOptions {
  surrealUrl: string;
  surrealUser: string;
  surrealPass: string;
  surrealNamespace: string;
  surrealDatabase: string;
}

export interface TurnRecord {
  session_id: string;
  agent_type: string;
  sequence: number;
  role: string;
  content: string;
  tokens_used?: number;
  timestamp: Date;
}

export class SessionStore {
  private db: Surreal;
  private sessionId: string;
  private agentType: string;
  private sequence = 0;

  constructor(db: Surreal, sessionId: string, agentType: string) {
    this.db = db;
    this.sessionId = sessionId;
    this.agentType = agentType;
  }

  static async connect(
    options: SessionStoreOptions,
    sessionId: string,
    agentType: string,
  ): Promise<SessionStore> {
    const db = new Surreal();
    await db.connect(options.surrealUrl);
    await db.signin({
      username: options.surrealUser,
      password: options.surrealPass,
    });
    await db.use({
      namespace: options.surrealNamespace,
      database: options.surrealDatabase,
    });

    // Create session via raw query with bindings
    await db.query(
      "CREATE session CONTENT { session_id: $id, agent_type: $type, status: 'active', created_at: time::now(), updated_at: time::now() }",
      { id: sessionId, type: agentType },
    );

    console.log(`[SDA] Session store connected: ${sessionId}`);
    return new SessionStore(db, sessionId, agentType);
  }

  async recordTurn(turn: Omit<TurnRecord, "session_id" | "agent_type" | "sequence" | "timestamp">): Promise<void> {
    this.sequence++;
    await this.db.query(
      "CREATE turn CONTENT { session: type::record('session', $sid), session_id: $sid, agent_type: $type, sequence: $seq, role: $role, content: $content, tokens_used: $tokens, timestamp: time::now() }",
      {
        sid: this.sessionId,
        type: this.agentType,
        seq: this.sequence,
        role: turn.role,
        content: turn.content,
        tokens: turn.tokens_used ?? 0,
      },
    );

    await this.db.query("UPDATE session SET updated_at = time::now() WHERE session_id = $id", {
      id: this.sessionId,
    });
  }

  async closeSession(): Promise<void> {
    await this.db.query(
      "UPDATE session SET status = 'closed', updated_at = time::now() WHERE session_id = $id",
      { id: this.sessionId },
    );
    console.log(`[SDA] Session closed: ${this.sessionId}`);
  }

  getSessionId(): string {
    return this.sessionId;
  }
}
