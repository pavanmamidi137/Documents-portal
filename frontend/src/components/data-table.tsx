"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  rowKey: (row: T) => string | number;
}

export function DataTable<T>({
  columns,
  data,
  count,
  page,
  pageSize,
  onPageChange,
  loading = false,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  emptyTitle = "Nothing here yet",
  emptyDescription = "No records found matching your criteria.",
  toolbar,
  rowKey,
}: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="space-y-4">
      {(onSearchChange || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {onSearchChange ? (
            <div className="relative w-full max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 bg-muted/50 pl-9"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbar}
        </div>
      )}

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("h-11", col.headerClassName)}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-48 text-center">
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center gap-2 text-muted-foreground"
                  >
                    <Inbox className="size-10 opacity-40" />
                    <p className="font-medium text-foreground">{emptyTitle}</p>
                    <p className="text-sm">{emptyDescription}</p>
                  </motion.div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => (
                <TableRow key={rowKey(row)} className="transition-colors hover:bg-muted/40">
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn("py-3", col.className)}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          Showing{" "}
          <span className="font-medium text-foreground">
            {count === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)}
          </span>{" "}
          of <span className="font-medium text-foreground">{count}</span>
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-4" /> Previous
          </Button>
          <span className="px-2">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            Next <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
