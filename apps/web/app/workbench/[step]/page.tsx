import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workbench } from "../../components/workbench";
import { getRequestLocale } from "../../lib/i18n-server";

const validSteps = new Set(["project", "compute", "data", "train", "evaluation", "models", "settings"]);

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: locale === "en" ? "Training Workbench" : "训练工作台", description: locale === "en" ? "Manage your data, compute, training, evaluation, and model artifacts." : "管理你的数据、算力、训练、评测和模型产物。", robots: { index: false, follow: false } };
}

export default async function WorkbenchStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!validSteps.has(step)) notFound();
  return <Workbench />;
}
