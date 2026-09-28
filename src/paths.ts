// Repository-relative paths, always with `/` separators, "" for the root.

export function dir(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function name(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function join(dir: string, rel: string): string {
  return dir === "" ? rel : `${dir}/${rel}`;
}

/** Resolves `.` and `..`; null when the path leaves the repository. */
export function normalize(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** Whether `path` is `folder` itself or inside it. */
export function within(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/** The lowest folder containing every one of `folders`. */
export function commonFolder(folders: Iterable<string>): string {
  let common: string[] | null = null;
  for (const folder of folders) {
    const parts = folder.split("/").filter((p) => p !== "");
    if (common === null) {
      common = parts;
      continue;
    }
    let n = 0;
    while (n < common.length && n < parts.length && common[n] === parts[n]) n++;
    common = common.slice(0, n);
  }
  return (common ?? []).join("/");
}
