"use client";
import { PageRecovery } from "@/components/ui/PageRecovery";
export default function Error({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return <PageRecovery retry={retry} />;
}
