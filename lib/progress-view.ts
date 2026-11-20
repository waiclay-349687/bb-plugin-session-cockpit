/**
 * [INPUT]: Worktree Lineage 存盘的速览（概括 + 阶段）。
 * [OUTPUT]: briefingDisplay（Progress 要显示的文字：概括、每个阶段的标题与细则、收起时显示哪个阶段与完成数）。
 * [POS]: 可单测的展示层，被 components/cockpit/progress-section.tsx 使用。速览不论什么语言都原样显示（与 Worktree Lineage 悬停卡片同一份），
 *        只有字段本身是空的才用占位字；绝不因为板块语言与速览语言不同而换成“第 1 阶段”。
 * [PROTOCOL]: 变更时更新此头部,然后检查所在目录 CLAUDE.md
 */
export interface DisplayStage {
  title: string;
  state: "done" | "doing" | "dropped";
  note: string;
}

export interface BriefingDisplay {
  about: string;
  stages: { title: string; note: string | null; state: DisplayStage["state"] }[];
  headline: { title: string; state: DisplayStage["state"] } | null;
  done: number;
  total: number;
}

/** 收起时显示哪个阶段：进行中的那个；没有进行中的（全做完了）就显示最后一个没放弃的 */
function headlineIndex(stages: readonly DisplayStage[]): number {
  const doing = stages.findIndex((stage) => stage.state === "doing");
  if (doing >= 0) return doing;
  for (let i = stages.length - 1; i >= 0; i -= 1) if (stages[i]!.state !== "dropped") return i;
  return stages.length - 1;
}

export function briefingDisplay(
  briefing: { about: string; stages: readonly DisplayStage[] },
  fallback: { about: string; stage: (n: number) => string },
): BriefingDisplay {
  const stages = briefing.stages.map((stage, index) => ({
    title: stage.title.trim() || fallback.stage(index + 1),
    note: stage.note.trim() || null,
    state: stage.state,
  }));
  const index = headlineIndex(briefing.stages);
  return {
    about: briefing.about.trim() || fallback.about,
    stages,
    headline: index >= 0 ? { title: stages[index]!.title, state: stages[index]!.state } : null,
    done: briefing.stages.filter((stage) => stage.state === "done").length,
    total: briefing.stages.filter((stage) => stage.state !== "dropped").length,
  };
}
