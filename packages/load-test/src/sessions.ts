// Seeds disposable Auth.js database sessions so load bots pass the WS upgrade's
// session gate, then tears them down at the end of a run.
//
// The WS upgrade rejects anonymous connections: it resolves the parent-domain
// session cookie against the Mongo `sessions` collection via the Auth.js adapter
// (server/src/auth.ts resolveSessionUser -> adapter.getSessionAndUser). There is
// no programmatic sign-in (Google OAuth only), so the harness writes the user +
// session documents directly, in the exact shape the adapter reads back:
//   users:    { _id: ObjectId, email, name }
//   sessions: { _id: ObjectId, sessionToken: string, userId: ObjectId, expires }
// (see node_modules/@auth/mongodb-adapter getSessionAndUser).
//
// Every seeded document carries `loadTest: true` and the run's `runId` so
// teardown is exact and a crashed run's leftovers are identifiable. Emails use
// the reserved `.invalid` TLD so they can never collide with a real Google
// account.

import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";

export type SeededSession = {
  userId: string;
  sessionToken: string;
};

export type SeedResult = {
  sessions: SeededSession[];
  cleanup: () => Promise<void>;
};

type SeedOptions = {
  mongoUrl: string;
  mongoDb: string;
  count: number;
  ttlMs: number;
};

export async function seedSessions(opts: SeedOptions): Promise<SeedResult> {
  const client = new MongoClient(opts.mongoUrl);
  await client.connect();
  const db = client.db(opts.mongoDb);
  const users = db.collection("users");
  const sessions = db.collection("sessions");

  const runId = `loadtest-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const expires = new Date(Date.now() + opts.ttlMs);

  const userDocs = [];
  const sessionDocs = [];
  const seeded: SeededSession[] = [];
  for (let i = 0; i < opts.count; i++) {
    const userId = new ObjectId();
    const sessionToken = randomUUID();
    userDocs.push({
      _id: userId,
      email: `loadbot+${runId}-${i}@loadtest.invalid`,
      name: `loadbot ${i}`,
      loadTest: true,
      runId,
    });
    sessionDocs.push({
      _id: new ObjectId(),
      sessionToken,
      userId,
      expires,
      loadTest: true,
      runId,
    });
    seeded.push({ userId: userId.toHexString(), sessionToken });
  }

  try {
    await users.insertMany(userDocs);
    await sessions.insertMany(sessionDocs);
  } catch (e) {
    // A partial insert still leaves taggable docs behind; drop them before
    // surfacing the failure so a retry starts clean.
    await users.deleteMany({ loadTest: true, runId });
    await sessions.deleteMany({ loadTest: true, runId });
    await client.close();
    throw e;
  }

  const cleanup = async (): Promise<void> => {
    try {
      await users.deleteMany({ loadTest: true, runId });
      await sessions.deleteMany({ loadTest: true, runId });
    } finally {
      await client.close();
    }
  };

  return { sessions: seeded, cleanup };
}

// Cookie header value for a seeded session. The cookie name must match the
// server's (server/src/auth.ts sessionCookieName): the __Secure- prefix is used
// only when the auth host is https, which a wss target implies. Set explicitly
// via the runner's `secure` flag rather than guessed here.
export function sessionCookie(token: string, secure: boolean): string {
  const name = secure ? "__Secure-authjs.session-token" : "authjs.session-token";
  return `${name}=${token}`;
}
