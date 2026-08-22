import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export function Widget() {
  useEffect(() => {
    fetch("/api");
  }, []);
  const q = useQuery({ queryKey: ["x"], queryFn: () => 1 });
  return q.data;
}
