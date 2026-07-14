import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ModuleDossier } from "@/features/control/components/ModuleDossier";
import { EffectorWorkspace } from "@/features/control/components/EffectorWorkspace";
import {
  CONTROL_MODULES,
  getControlModule,
} from "@/features/control/model/control-modules";

export const dynamicParams = false;

interface ControlModulePageProps {
  readonly params: Promise<{ readonly module: string }>;
}

export function generateStaticParams() {
  return CONTROL_MODULES.map((module) => ({ module: module.id }));
}

export async function generateMetadata({
  params,
}: ControlModulePageProps): Promise<Metadata> {
  const { module: moduleId } = await params;
  const moduleDefinition = getControlModule(moduleId);
  return {
    title: (moduleDefinition?.title ?? "档案不存在") + " · ASTR Control",
  };
}

export default async function ControlModulePage({ params }: ControlModulePageProps) {
  const { module: moduleId } = await params;
  const moduleDefinition = getControlModule(moduleId);
  if (moduleDefinition === undefined) notFound();

  if (moduleDefinition.id === "effector") {
    return <EffectorWorkspace module={moduleDefinition} />;
  }
  return <ModuleDossier module={moduleDefinition} />;
}
