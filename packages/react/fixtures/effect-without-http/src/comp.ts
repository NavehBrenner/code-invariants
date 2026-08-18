import { useEffect } from "react";

export function Comp() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  }, []);
}
