import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Workbench } from "../../components/workbench";

const validSteps = new Set(["project", "compute", "data", "train", "evaluation", "models", "settings"]);

export const metadata: Metadata = {
  title: "训练工作台",
  description: "管理你的数据、算力、训练、评测和模型产物。",
  robots: { index: false, follow: false },
};

export default async function WorkbenchStepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!validSteps.has(step)) notFound();
  return <Workbench />;
}
