import { redirect } from "next/navigation";

/** Old path: Create Policy became Insure. Keeps bookmarks and World ID return URLs (`?wid=`) working. */
export default async function CreateRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  const s = qs.toString();
  redirect(s ? `/insure?${s}` : "/insure");
}
