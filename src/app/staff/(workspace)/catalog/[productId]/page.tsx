import { notFound } from "next/navigation";
import { z } from "zod";
import { getStaffProduct, listCategoriesForStaff, type StaffProductView } from "@/modules/catalog/admin";
import { isDomainError } from "@/modules/shared/errors";
import { Notice } from "@/components/ui/Notice";
import { staffPageAccess } from "@/server/staff-page";
import { ProductEditor } from "../ProductEditor";

export const dynamic = "force-dynamic";

async function loadProduct(productId: string): Promise<StaffProductView | null> {
  if (!z.uuid().safeParse(productId).success) return null;
  try {
    return await getStaffProduct(productId);
  } catch (error) {
    if (isDomainError(error)) return null;
    throw error;
  }
}

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const access = await staffPageAccess("catalog.read");
  if (access.kind === "NONE") return null;
  if (access.kind === "FORBIDDEN") return <Notice tone="warning" title="Your role does not include the catalog." />;
  const { productId } = await params;
  const categories = await listCategoriesForStaff();
  if (productId === "new") return <ProductEditor categories={categories} product={null} />;
  const product = await loadProduct(productId);
  if (!product) notFound();
  return <ProductEditor categories={categories} product={product} />;
}
