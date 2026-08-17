export type Project = {
  id: string;
  name: string;
  goal: string;
  success_criteria: string;
};

export type Runner = {
  id: string;
  name: string;
  status: "online" | "busy" | "offline";
  current_job_id: string | null;
  last_seen_at: string | null;
  capabilities: {
    ready?: boolean;
    backend?: "docker_cuda" | "docker_cpu" | "native_mps";
    cpu_cores?: number;
    memory_total_mb?: number;
    disk_total_mb?: number;
    disk_free_mb?: number;
    training_environment_version?: string;
    supported_tasks?: string[];
    mps_available?: boolean;
    gpus?: Array<{ name: string; memory_total_mb: number; memory_free_mb: number; utilization_percent?: number; temperature_c?: number; shared_memory?: boolean }>;
  };
};

export type Dataset = {
  id: string;
  project_id: string;
  runner_id: string;
  name: string;
  source_type: "local" | "huggingface" | "modelscope" | "s3" | "starter";
  source_ref: string;
  format: "json" | "jsonl" | "csv" | "txt" | "archive";
  mapping: { instruction: string; input: string; output: string };
  split: { train: number; validation: number; test: number };
  status: "checking" | "ready" | "failed";
  version_hash: string | null;
  statistics: null | {
    rows: number;
    valid_rows: number;
    invalid_rows: number;
    empty_rows: number;
    duplicates: number;
    similar_duplicates: number;
    token_length: { p50: number; p95: number; max: number };
    splits: { train: number; validation: number; test: number };
    leakage: { exact_matches: number };
    characters?: number;
    vocabulary_size?: number;
  };
  preview: null | Array<{ instruction: string; input: string; output: string }>;
};

export type JobEvent = {
  id: number;
  type: string;
  message: string | null;
  payload: Record<string, number | string>;
  created_at: string;
};

export type Job = {
  id: string;
  kind: "inspect" | "baseline" | "train" | "evaluate" | "export" | "chat";
  status: "blocked" | "queued" | "leased" | "running" | "paused" | "completed" | "failed" | "cancelled";
  desired_state: "running" | "paused" | "cancelled";
  progress: number;
  error: string | null;
  experiment_id: string | null;
  dataset_id: string | null;
  prompt?: string;
  events: JobEvent[];
};

export type Metrics = {
  samples?: number;
  exact_match?: number;
  format_pass_rate?: number;
  first_token_latency_ms?: number;
  tokens_per_second?: number;
  peak_gpu_memory_mb?: number;
  model_size_mb?: number;
  test_loss?: number;
  perplexity?: number;
  test_characters?: number;
};

export type EvaluationSample = { instruction: string; input: string; reference: string; prediction: string };

export type Experiment = {
  id: string;
  project_id: string;
  runner_id: string;
  dataset_id: string;
  name: string;
  model: { id: string; revision: string };
  training: { method: "lora" | "qlora" | "starter"; epochs: number; learning_rate: number; max_length: number; iterations?: number };
  export_formats: string[];
  output_destination: "local" | "user_s3";
  output_s3_uri: string | null;
  license_confirmed: boolean;
  status: "queued" | "running" | "awaiting_selection" | "completed" | "failed" | "cancelled";
  current_stage: string;
  baseline_metrics: Metrics | null;
  tuned_metrics: Metrics | null;
  artifacts: null | Array<{ format: string; reference: string }>;
  evaluation_samples: null | { baseline?: EvaluationSample[]; tuned?: EvaluationSample[] };
  checkpoints: null | Array<{ reference: string; label: string; recommended?: boolean; step?: number; validation_loss?: number }>;
  selected_checkpoint: string | null;
};

export type WorkspaceState = {
  workspace: { id: string; name: string };
  account: { email: string; name: string | null; plan: "free" | "paid" };
  project_quota: { used: number; limit: number; remaining: number };
  current_project_id: string | null;
  projects: Project[];
  runners: Runner[];
  datasets: Dataset[];
  experiments: Experiment[];
  jobs: Job[];
};

export type ApiConnection = {
  id: string;
  name: string;
  purpose: string;
  capabilities: string[];
  credential_hint: string;
  status: "active" | "revoked";
  created_at: string;
  rotated_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export type ApiActivity = {
  id: string;
  connection_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: "succeeded" | "failed";
  occurred_at: string;
};
