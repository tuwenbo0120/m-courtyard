import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./db";

export type FineTuneType = "lora" | "dora" | "full";
export type OptimizerType = "adam" | "adamw" | "sgd" | "adafactor";

export interface TrainingParams {
  model: string;
  data: string;
  train_file: string;
  valid_file: string;
  adapter_path: string;
  fine_tune_type: FineTuneType;
  optimizer: OptimizerType;
  iters: number;
  batch_size: number;
  lora_layers: number;
  lora_rank: number;
  lora_scale: number;
  lora_dropout: number;
  learning_rate: number;
  max_seq_length: number;
  grad_checkpoint: boolean;
  grad_accumulation_steps: number;
  save_every: number;
  mask_prompt: boolean;
  steps_per_eval: number;
  steps_per_report: number;
  val_batches: number;
  seed: number;
  lora_scale_strategy: "standard" | "rslora";
}

export interface TrainingJob {
  id: string;
  project_id: string;
  params: string;
  status: string;
  final_loss: number | null;
  duration_s: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export function defaultTrainingParams(): TrainingParams {
  return {
    model: "",
    data: "",
    train_file: "train.jsonl",
    valid_file: "valid.jsonl",
    adapter_path: "adapters",
    fine_tune_type: "lora",
    optimizer: "adam",
    iters: 1000,
    batch_size: 4,
    lora_layers: 16,
    lora_rank: 8,
    lora_scale: 20.0,
    lora_dropout: 0.0,
    learning_rate: 1e-5,
    max_seq_length: 2048,
    grad_checkpoint: false,
    grad_accumulation_steps: 1,
    save_every: 100,
    mask_prompt: false,
    steps_per_eval: 200,
    steps_per_report: 10,
    val_batches: 25,
    seed: 0,
    lora_scale_strategy: "standard",
  };
}

export async function startTraining(
  projectId: string,
  params: TrainingParams
): Promise<string> {
  const jobId: string = await invoke("start_training", {
    projectId,
    params: JSON.stringify(params),
  });
  const db = await getDb();
  await db.execute(
    "INSERT INTO training_jobs (id, project_id, params, status, started_at) VALUES ($1, $2, $3, 'running', datetime('now'))",
    [jobId, projectId, JSON.stringify(params)]
  );
  return jobId;
}

export async function getTrainingJobs(
  projectId: string
): Promise<TrainingJob[]> {
  const db = await getDb();
  return db.select<TrainingJob[]>(
    "SELECT * FROM training_jobs WHERE project_id = $1 ORDER BY started_at DESC",
    [projectId]
  );
}
