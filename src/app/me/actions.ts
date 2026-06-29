"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateBattleTag as updateBattleTagRepo } from "@/lib/repositories/users";
import { updateBattleTagSchema } from "./schema";

/**
 * マイページの「バトルタグ更新」 Server Action（Controller）。
 *
 * 防御:
 * 1. ログイン確認（認証バイパス対策）。
 * 2. Zod 検証（任意・空は未登録に戻す。32文字以内）。
 * 3. battle_tag のみ更新（Repository が列を固定＝マスアサインメント対策）。
 *    行レベルは RLS（0025・本人のみ）が最終防衛。user_id はセッション固定。
 */
export type UpdateBattleTagState = {
  error?: string;
  ok?: boolean;
  fieldErrors?: Record<string, string>;
};

export async function updateBattleTag(
  _prev: UpdateBattleTagState,
  formData: FormData,
): Promise<UpdateBattleTagState> {
  // 1. ログイン確認
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "ログインが必要です。" };
  }

  // 2. 検証
  const parsed = updateBattleTagSchema.safeParse({
    battleTag: formData.get("battleTag"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "入力内容を確認してください。", fieldErrors };
  }

  // 3. 更新（空文字は null＝未登録に戻す）。user_id はセッション固定。
  const trimmed = parsed.data.battleTag;
  await updateBattleTagRepo({
    userId: user.id,
    battleTag: trimmed === "" ? null : trimmed,
  });

  revalidatePath("/me");
  return { ok: true };
}
