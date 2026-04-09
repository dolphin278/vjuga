/** Shared type definitions for benchmark-apps. */

export interface User {
  id: number;
  username: string;
  password_hash: string;
  email: string;
  created_at: number;
}

export interface Session {
  token: string;
  user_id: number;
  expires_at: number;
}

export interface LoginBody {
  user: string;
  pass: string;
}

export interface CreateUserBody {
  username: string;
  password: string;
  email: string;
}

export interface UpdateUserBody {
  username?: string;
  password?: string;
  email?: string;
}

export interface BenchScenario {
  name: string;
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
  /** Setup function called before the scenario runs (e.g., to create a session cookie). */
  setup?: (port: number) => Promise<Record<string, string>>;
}

export interface BenchResult {
  scenario: string;
  rps: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  latencyMax: number;
  totalRequests: number;
  errors: number;
  heapUsedBefore: number;
  heapUsedAfter: number;
}

export interface ServerMetrics {
  label: string;
  results: BenchResult[];
}
