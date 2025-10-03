import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, uintCV, noneCV, someCV, tupleCV, boolCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_MENTOR = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_DATE = 103;
const ERR_SESSION_NOT_FOUND = 104;
const ERR_INVALID_STATUS = 106;
const ERR_MENTOR_NOT_AVAILABLE = 110;
const ERR_INVALID_TIMESTAMP = 111;
const ERR_MENTOR_REGISTRY_NOT_SET = 113;
const ERR_TOKEN_CONTRACT_NOT_SET = 114;

interface Session {
  mentor: string;
  mentee: string;
  date: string;
  price: number;
  status: string;
  timestamp: number;
  feedbackSubmitted: boolean;
}

interface Availability {
  sessionCount: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class SessionBookingMock {
  state: {
    sessionCounter: number;
    mentorRegistryContract: string | null;
    tokenContract: string | null;
    cancellationFee: number;
    maxSessionsPerDay: number;
    sessions: Map<number, Session>;
    mentorAvailability: Map<string, Availability>;
  } = {
    sessionCounter: 0,
    mentorRegistryContract: null,
    tokenContract: null,
    cancellationFee: 100,
    maxSessionsPerDay: 5,
    sessions: new Map(),
    mentorAvailability: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1MENTEE";
  verifiedMentors: Set<string> = new Set(["ST2MENTOR"]);
  tokenTransfers: Array<{ amount: number; from: string; to: string }> = [];

  reset() {
    this.state = {
      sessionCounter: 0,
      mentorRegistryContract: null,
      tokenContract: null,
      cancellationFee: 100,
      maxSessionsPerDay: 5,
      sessions: new Map(),
      mentorAvailability: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1MENTEE";
    this.verifiedMentors = new Set(["ST2MENTOR"]);
    this.tokenTransfers = [];
  }

  setMentorRegistry(registry: string): Result<boolean> {
    if (this.state.mentorRegistryContract !== null) return { ok: false, value: false };
    this.state.mentorRegistryContract = registry;
    return { ok: true, value: true };
  }

  setTokenContract(token: string): Result<boolean> {
    if (this.state.tokenContract !== null) return { ok: false, value: false };
    this.state.tokenContract = token;
    return { ok: true, value: true };
  }

  setCancellationFee(fee: number): Result<boolean> {
    if (fee < 0) return { ok: false, value: false };
    this.state.cancellationFee = fee;
    return { ok: true, value: true };
  }

  bookSession(mentor: string, price: number, date: string): Result<number> {
    if (!this.state.mentorRegistryContract) return { ok: false, value: ERR_MENTOR_REGISTRY_NOT_SET };
    if (!this.state.tokenContract) return { ok: false, value: ERR_TOKEN_CONTRACT_NOT_SET };
    if (!this.verifiedMentors.has(mentor)) return { ok: false, value: ERR_INVALID_MENTOR };
    if (price <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (!date || date.length > 10) return { ok: false, value: ERR_INVALID_DATE };
    const key = `${mentor}-${date}`;
    const availability = this.state.mentorAvailability.get(key) || { sessionCount: 0 };
    if (availability.sessionCount >= this.state.maxSessionsPerDay) return { ok: false, value: ERR_MENTOR_NOT_AVAILABLE };
    this.tokenTransfers.push({ amount: price, from: this.caller, to: mentor });
    const sessionId = this.state.sessionCounter;
    this.state.sessions.set(sessionId, {
      mentor,
      mentee: this.caller,
      date,
      price,
      status: "pending",
      timestamp: this.blockHeight,
      feedbackSubmitted: false,
    });
    this.state.mentorAvailability.set(key, { sessionCount: availability.sessionCount + 1 });
    this.state.sessionCounter++;
    return { ok: true, value: sessionId };
  }

  confirmSession(sessionId: number): Result<boolean> {
    const session = this.state.sessions.get(sessionId);
    if (!session) return { ok: false, value: false };
    if (session.mentor !== this.caller) return { ok: false, value: false };
    if (session.status !== "pending") return { ok: false, value: false };
    if (session.timestamp < this.blockHeight) return { ok: false, value: false };
    this.state.sessions.set(sessionId, { ...session, status: "confirmed" });
    return { ok: true, value: true };
  }

  cancelSession(sessionId: number): Result<boolean> {
    const session = this.state.sessions.get(sessionId);
    if (!session) return { ok: false, value: false };
    if (session.mentee !== this.caller && session.mentor !== this.caller) return { ok: false, value: false };
    if (session.status !== "pending") return { ok: false, value: false };
    if (session.timestamp < this.blockHeight) return { ok: false, value: false };
    if (!this.state.tokenContract) return { ok: false, value: ERR_TOKEN_CONTRACT_NOT_SET };
    this.tokenTransfers.push({
      amount: this.caller === session.mentee ? this.state.cancellationFee : session.price,
      from: this.caller,
      to: this.caller === session.mentee ? session.mentor : session.mentee,
    });
    this.state.sessions.set(sessionId, { ...session, status: "cancelled" });
    const key = `${session.mentor}-${session.date}`;
    const availability = this.state.mentorAvailability.get(key) || { sessionCount: 0 };
    this.state.mentorAvailability.set(key, { sessionCount: availability.sessionCount - 1 });
    return { ok: true, value: true };
  }

  getSession(sessionId: number): Session | null {
    return this.state.sessions.get(sessionId) || null;
  }

  getAvailability(mentor: string, date: string): Availability {
    return this.state.mentorAvailability.get(`${mentor}-${date}`) || { sessionCount: 0 };
  }

  getSessionCount(): Result<number> {
    return { ok: true, value: this.state.sessionCounter };
  }
}

describe("SessionBooking", () => {
  let contract: SessionBookingMock;

  beforeEach(() => {
    contract = new SessionBookingMock();
    contract.reset();
    contract.setMentorRegistry("ST3REGISTRY");
    contract.setTokenContract("ST4TOKEN");
  });

  it("books a session successfully", () => {
    const result = contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const session = contract.getSession(0);
    expect(session?.mentor).toBe("ST2MENTOR");
    expect(session?.mentee).toBe("ST1MENTEE");
    expect(session?.price).toBe(500);
    expect(session?.status).toBe("pending");
    expect(contract.getAvailability("ST2MENTOR", "2025-10-05").sessionCount).toBe(1);
    expect(contract.tokenTransfers).toEqual([{ amount: 500, from: "ST1MENTEE", to: "ST2MENTOR" }]);
  });

  it("rejects booking with invalid mentor", () => {
    const result = contract.bookSession("ST5INVALID", 500, "2025-10-05");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_MENTOR);
  });

  it("rejects booking with invalid amount", () => {
    const result = contract.bookSession("ST2MENTOR", 0, "2025-10-05");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects booking with invalid date", () => {
    const result = contract.bookSession("ST2MENTOR", 500, "");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DATE);
  });

  it("rejects booking when mentor is unavailable", () => {
    contract.state.mentorAvailability.set("ST2MENTOR-2025-10-05", { sessionCount: 5 });
    const result = contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MENTOR_NOT_AVAILABLE);
  });

  it("confirms a session successfully", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    contract.caller = "ST2MENTOR";
    const result = contract.confirmSession(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const session = contract.getSession(0);
    expect(session?.status).toBe("confirmed");
  });

  it("rejects confirm by non-mentor", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    contract.caller = "ST3FAKE";
    const result = contract.confirmSession(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("cancels a session by mentee successfully", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    const result = contract.cancelSession(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const session = contract.getSession(0);
    expect(session?.status).toBe("cancelled");
    expect(contract.getAvailability("ST2MENTOR", "2025-10-05").sessionCount).toBe(0);
    expect(contract.tokenTransfers).toEqual([
      { amount: 500, from: "ST1MENTEE", to: "ST2MENTOR" },
      { amount: 100, from: "ST1MENTEE", to: "ST2MENTOR" },
    ]);
  });

  it("cancels a session by mentor successfully", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    contract.caller = "ST2MENTOR";
    const result = contract.cancelSession(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const session = contract.getSession(0);
    expect(session?.status).toBe("cancelled");
    expect(contract.getAvailability("ST2MENTOR", "2025-10-05").sessionCount).toBe(0);
    expect(contract.tokenTransfers).toEqual([
      { amount: 500, from: "ST1MENTEE", to: "ST2MENTOR" },
      { amount: 500, from: "ST2MENTOR", to: "ST1MENTEE" },
    ]);
  });

  it("rejects cancellation by unauthorized caller", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    contract.caller = "ST3FAKE";
    const result = contract.cancelSession(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets cancellation fee successfully", () => {
    const result = contract.setCancellationFee(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.cancellationFee).toBe(200);
  });

  it("returns correct session count", () => {
    contract.bookSession("ST2MENTOR", 500, "2025-10-05");
    contract.bookSession("ST2MENTOR", 600, "2025-10-06");
    const result = contract.getSessionCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
  });
});