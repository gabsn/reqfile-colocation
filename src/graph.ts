// The repository as every analysis sees it, and what each language analysis
// returns: resolved dependencies, module boundaries, and what it could not
// resolve. Rules read only these types.

/** A dependency of `from` on `to`, both repository paths. */
export type Edge = {
  from: string;
  /** A file, or for a path reference, a file or folder. */
  to: string;
  /** An import, or a path written in a command, script, manifest or string. */
  kind: "import" | "path";
  line: number;
  /** Named items used; empty when the whole module is. */
  items: string[];
  /** Set when the language decides the dependency enters a boundary past its
   * interface: the boundary folder and its interface file. */
  bypass?: { boundary: string; entry: string };
  /** For a path written in a command: the other paths the same command names,
   * which tell where the command's work lives. */
  via?: string[];
};

/** A folder the language marks as a module with an interface. */
export type Boundary = { folder: string; entry: string };

/** Something the analysis could not resolve, so the check cannot vouch for it. */
export type Unverifiable = { path: string; line?: number; reason: string };

export type Analysis = { edges: Edge[]; boundaries: Boundary[]; unverifiable: Unverifiable[] };

export const empty = (): Analysis => ({ edges: [], boundaries: [], unverifiable: [] });

export function merge(analyses: Analysis[]): Analysis {
  return {
    edges: analyses.flatMap((a) => a.edges),
    boundaries: analyses.flatMap((a) => a.boundaries),
    unverifiable: analyses.flatMap((a) => a.unverifiable),
  };
}
