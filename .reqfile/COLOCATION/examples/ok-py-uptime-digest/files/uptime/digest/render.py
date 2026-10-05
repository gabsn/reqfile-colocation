def render(results):
    down = [r["url"] for r in results if not r["up"]]
    if not down:
        return f"All {len(results)} targets up."
    lines = [f"{len(down)} of {len(results)} targets down:"]
    lines += [f"- {url}" for url in down]
    return "\n".join(lines)
