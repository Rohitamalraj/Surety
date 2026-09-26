"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const useDeployments = () =>
  useQuery({ queryKey: ["deployments"], queryFn: api.deployments, staleTime: 60_000, retry: 1 });

export const useSolvency = () =>
  useQuery({ queryKey: ["solvency"], queryFn: api.solvency, refetchInterval: 5_000, retry: 0 });

export const useFeed = (node?: string) =>
  useQuery({ queryKey: ["feed", node ?? "all"], queryFn: () => api.feed(node), refetchInterval: 4_000, retry: 0 });

export const usePolicy = (node?: string) =>
  useQuery({
    queryKey: ["policy", node],
    queryFn: () => api.policy(node!),
    enabled: !!node,
    refetchInterval: 4_000,
    retry: 0,
  });

export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000, retry: 0 });
