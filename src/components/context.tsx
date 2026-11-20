"use client";
import { createContext, useContext } from "react";
import type { Snapshot } from "@/lib/types";
export type AppContextValue = {
  data: Snapshot;
  userId: string;
  busy: boolean;
  mutate: (method: string, path: string, body?: unknown) => Promise<any>;
  upload: (path: string, file: File) => Promise<any>;
  notify: (message: string, tone?: "success" | "error") => void;
  refresh: () => Promise<void>;
  openContact: (id: string) => void;
  openOrder: (contactId?: string) => void;
  navigate: (page: string) => void;
};
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("Missing workspace provider.");
  return ctx;
}
