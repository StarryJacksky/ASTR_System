import { notFound } from "next/navigation";

import { ModuleDossier } from "@/features/control/components/ModuleDossier";
import { EffectorWorkspace } from "@/features/control/components/EffectorWorkspace";
import {
  CONTROL_MODULES,
  getControlModule,
} from "@/features/control/model/control-modules";

export const dynamicParams = false;

export function generateStaticParams() {
  return CONTROL_MODULES.map((module) => ({ module: module.id }));
}

export default async function ControlModulePage({
  params,
}: {
  readonly params: Promise<{ readonly module: string }>;
}) {
  const { module: moduleId } = await params;
  const moduleDefinition = getControlModule(moduleId);
  if (moduleDefinition === undefined) notFound();

  if (moduleDefinition.id === "effector") {
    return <EffectorWorkspace module={moduleDefinition} />;
  }
  return <ModuleDossier module={moduleDefinition} />;
}
