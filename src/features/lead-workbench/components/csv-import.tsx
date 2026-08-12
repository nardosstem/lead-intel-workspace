"use client";

import { useRef, useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { importCompaniesCsv } from "../server/actions";

export function CsvImport({ onImported }: Readonly<{ onImported: () => void }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error("CSV import is limited to 5 MB.");
      event.target.value = "";
      return;
    }
    setFileName(file.name);
    startTransition(async () => {
      try {
        const result = await importCompaniesCsv(await file.text());
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`${result.data.imported} companies imported`);
        if (result.data.errors.length > 0) {
          const preview = result.data.errors
            .slice(0, 3)
            .map((error) => `Row ${error.row}: ${error.message}`)
            .join(" · ");
          toast.warning(`${result.data.errors.length} CSV rows were skipped`, {
            description: `${preview}${result.data.errors.length > 3 ? " · More errors are available in the import result." : ""}`,
            duration: 8_000,
          });
        }
        onImported();
        if (inputRef.current) inputRef.current.value = "";
      } catch {
        toast.error("The CSV import could not be completed. Try again.");
      }
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={chooseFile}
        className="sr-only"
        aria-label="Import companies CSV"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
      >
        <FileUp className="size-4" aria-hidden="true" />
        {isPending ? "Importing…" : fileName ? "Import another CSV" : "Import CSV"}
      </Button>
    </>
  );
}
