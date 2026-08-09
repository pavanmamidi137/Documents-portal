"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  header: ReactNode;
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
  /** Enable multi-row selection via checkboxes and Ctrl/Cmd+click. */
  selectable?: boolean;
  onSelectionChange?: (keys: Array<string | number>) => void;
  /**
   * Keep the selection bar visible even with no rows ticked - used for
   * "select all matching across all pages" (the parent tracks that state).
   */
  selectionActive?: boolean;
  /**
   * Rendered above the table while rows are selected (bulk actions).
   * `selectAllOnPage` selects every row visible on the current page in one
   * click, so bulk delete reaches everything without per-row ticking.
   */
  selectionBar?: (
    selected: T[],
    clearSelection: () => void,
    selectAllOnPage: () => void
  ) => ReactNode;
  /**
   * Called with `page + 1` when a next page exists, so the consumer can
   * prefetch it (e.g. via queryClient.prefetchQuery) and make paging instant.
   */
  prefetchNextPage?: (page: number) => void;
  /**
   * Pressing Delete/Backspace while rows are selected fires this with the
   * rows ticked on the current page (may be empty in select-all-matching
   * mode) plus a `clearSelection` helper so the consumer can drop the visual
   * selection exactly like its Delete button does. Ignored while typing in
   * inputs or when a dialog/menu/select is open.
   */
  onDeleteKey?: (selected: T[], clearSelection: () => void) => void;
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
  selectable = false,
  onSelectionChange,
  selectionActive = false,
  selectionBar,
  prefetchNextPage,
  onDeleteKey,
}: DataTableProps<T>) {
  const [selected, setSelected] = useState<Set<string | number>>(new Set());

  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  // Warm the next page into the cache as soon as the current page is visible,
  // so clicking Next renders instantly instead of waiting for a fetch.
  // The callback is held in a ref so the effect only depends on [page, totalPages]
  // and doesn't re-run on every render (selection toggles, etc.).
  const prefetchRef = useRef(prefetchNextPage);
  useEffect(() => {
    prefetchRef.current = prefetchNextPage;
  });
  useEffect(() => {
    if (!prefetchRef.current || page >= totalPages) return;
    prefetchRef.current(page + 1);
  }, [page, totalPages]);

  const clearSelection = () => {
    setSelected(new Set());
    onSelectionChange?.([]);
  };

  // Selection is scoped to the current page: paging/search clears it so bulk
  // actions always operate on the rows the user can actually see.
  const changePage = (next: number) => {
    clearSelection();
    onPageChange(next);
  };

  const toggle = (key: string | number) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
    onSelectionChange?.(Array.from(next));
  };

  const setAllOnPage = (checked: boolean) => {
    const next = new Set(selected);
    data.forEach((row) => {
      const key = rowKey(row);
      if (checked) next.add(key);
      else next.delete(key);
    });
    setSelected(next);
    onSelectionChange?.(Array.from(next));
  };

  const pageKeys = useMemo(() => data.map((row) => rowKey(row)), [data, rowKey]);
  const allOnPageSelected =
    data.length > 0 && pageKeys.every((key) => selected.has(key));

  // Rows currently selected that still exist on this page.
  const selectedRows = useMemo(
    () => data.filter((row) => selected.has(rowKey(row))),
    [data, selected, rowKey]
  );

  // Delete/Backspace with rows selected opens the consumer's bulk-delete
  // confirm dialog (Esc dismisses it - dialogs close on Escape by default).
  // Callbacks are kept in refs so the listener never re-subscribes on render.
  const onDeleteKeyRef = useRef(onDeleteKey);
  useEffect(() => {
    onDeleteKeyRef.current = onDeleteKey;
  });
  const selectedRowsRef = useRef(selectedRows);
  useEffect(() => {
    selectedRowsRef.current = selectedRows;
  });
  const clearSelectionRef = useRef(clearSelection);
  useEffect(() => {
    clearSelectionRef.current = clearSelection;
  });
  useEffect(() => {
    if (!selectable || !onDeleteKeyRef.current) return;
    if (selected.size === 0 && !selectionActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Never hijack keys while typing or when a dialog/menu/select is open
      // (popups render in portals, so closest() still sees them via the tree).
      if (
        target.closest(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox'], [role='combobox']"
        )
      )
        return;
      e.preventDefault();
      onDeleteKeyRef.current?.(selectedRowsRef.current, clearSelectionRef.current);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectable, selected.size, selectionActive]);

  const handleRowClick = (e: React.MouseEvent, row: T) => {
    // Only ctrl/cmd+click selects, so plain clicks keep row actions working.
    if (!(e.ctrlKey || e.metaKey)) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea, label")) return;
    e.preventDefault();
    toggle(rowKey(row));
  };

  const allColumns: Column<T>[] = selectable
    ? [
        {
          key: "__select",
          header: (
            <Checkbox
              checked={allOnPageSelected}
              onCheckedChange={(v) => setAllOnPage(v === true)}
              aria-label="Select all on this page"
              className="data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            />
          ),
          cell: (row) => (
            <Checkbox
              checked={selected.has(rowKey(row))}
              onCheckedChange={() => toggle(rowKey(row))}
              onClick={(e) => e.stopPropagation()}
              aria-label="Select row"
              className="data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            />
          ),
          className: "w-10",
          headerClassName: "w-10",
        },
        ...columns,
      ]
    : columns;

  return (
    <div className="space-y-4">
      {(onSearchChange || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {onSearchChange ? (
            <div className="relative w-full min-w-0 max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(e) => {
                  clearSelection();
                  onSearchChange(e.target.value);
                }}
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

      {selectable && (selected.size > 0 || selectionActive) && selectionBar && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-primary/30 bg-primary/5 p-3"
        >
          {selectionBar(selectedRows, clearSelection, () => setAllOnPage(true))}
        </motion.div>
      )}

      <div className="min-w-0 rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {allColumns.map((col) => (
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
                  {allColumns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-48 text-center">
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
              data.map((row) => {
                const key = rowKey(row);
                const isSelected = selected.has(key);
                return (
                  <TableRow
                    key={key}
                    onClick={(e) => handleRowClick(e, row)}
                    className={cn(
                      "transition-colors hover:bg-muted/40",
                      selectable && "cursor-default",
                      isSelected && "bg-primary/5 hover:bg-primary/10"
                    )}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    {allColumns.map((col) => (
                      <TableCell key={col.key} className={cn("py-3", col.className)}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0">
          Showing{" "}
          <span className="font-medium text-foreground">
            {count === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)}
          </span>{" "}
          of <span className="font-medium text-foreground">{count}</span>
          {selectable && (selected.size > 0 || selectionActive) && (
            <span className="ml-2 text-primary">
              · {selectionActive ? `all ${count} matching selected` : `${selected.size} selected`}
            </span>
          )}
        </p>
        <div className="flex min-w-0 items-center justify-between gap-1 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={page <= 1 || loading}
            onClick={() => changePage(page - 1)}
          >
            <ChevronLeft className="size-4" /> Previous
          </Button>
          <span className="px-2 whitespace-nowrap">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            disabled={page >= totalPages || loading}
            onClick={() => changePage(page + 1)}
          >
            Next <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
