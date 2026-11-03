import { FileText } from "lucide-react";
import { Section } from "@/components/ui/page";
import { EmptyState } from "@/components/ui/states";
import { Table, TableScroll, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { db } from "@/server/db";
import { getRfqFiles } from "@/server/services/rfqs";
import { loadWorkspace } from "../data";

const KIND_LABEL: Record<string, string> = {
  RFQ_EMAIL: "RFQ email",
  PART_LIST: "Part list",
  DRAWING: "Drawing",
  QUOTE_PDF: "Quote sent",
  IMPORT: "Import",
  OTHER: "File",
};

function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function FilesTab({ params }: { params: Promise<{ rfqId: string }> }) {
  const ws = await loadWorkspace((await params).rfqId);
  const files = await getRfqFiles(db, ws.id);
  return (
    <Section
      title="Files"
      description="Drawings are under customer NDA: only signed-in named users can open them, and every view or download is logged."
      flush
    >
      {files.length === 0 ? (
        <EmptyState icon={FileText} title="No files on this RFQ" description="Files arrive with the RFQ email through intake, and every quote PDF sent is kept here." />
      ) : (
        <TableScroll>
          <Table className="min-w-[640px]">
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Kind</Th>
                <Th>Added</Th>
                <Th>Access log</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <a href={`/api/files/${f.id}`} download={f.filename} className="text-accent hover:underline underline-offset-2">
                      {f.filename}
                    </a>
                    <div className="text-xs text-ink-3">{size(f.sizeBytes)}</div>
                  </Td>
                  <Td className="text-ink-2">{KIND_LABEL[f.kind] ?? f.kind}</Td>
                  <Td className="text-ink-3">
                    {f.uploadedBy} · {formatDateTime(f.createdAt)}
                  </Td>
                  <Td className="text-xs text-ink-3">
                    {f.accessCount === 0 ? (
                      "Not opened yet"
                    ) : (
                      <>
                        {f.accessCount} access{f.accessCount > 1 ? "es" : ""}
                        {f.recentAccess[0] ? ` · last ${f.recentAccess[0].user}, ${formatDateTime(f.recentAccess[0].at)}` : ""}
                      </>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      )}
    </Section>
  );
}
