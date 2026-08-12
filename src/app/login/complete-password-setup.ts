"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "@/lib/auth/server";
import { auditLogs, getDatabase, users } from "@/lib/db";
import { ensureLeadContext } from "@/features/lead-workbench/server/context";

const passwordSchema = z.string().min(8).max(128);

/** Changes the Auth password before recording application onboarding state. */
export async function completePasswordSetup(
  password: string,
): Promise<{ ok: true } | { ok: false; error?: string }> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: "Use a password with at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error || !data.user) return { ok: false, error: "Your password could not be updated." };

  // Auth recovery can legitimately be the first successful interaction for a
  // pre-existing internal account. Ensure the application profile exists
  // before recording onboarding state; otherwise Auth would change the
  // password and the UI would incorrectly report failure because public.users
  // was absent.
  const context = await ensureLeadContext({
    allowExistingAuthUser: true,
    allowPasswordSetupIncomplete: true,
  });
  if (!context || context.userId !== data.user.id) {
    return {
      ok: false,
      error: "Your password was updated, but workspace access is not provisioned. Contact the workspace owner.",
    };
  }

  const now = new Date();
  return getDatabase().transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ passwordSetupAt: now })
      .where(and(eq(users.id, data.user.id), eq(users.isActive, true)))
      .returning({ id: users.id, organizationId: users.organizationId });
    const profile = updated[0];
    if (!profile) return { ok: false };

    await tx.insert(auditLogs).values({
      organizationId: profile.organizationId,
      actorUserId: data.user.id,
      action: "member_password_setup_completed",
      entityType: "user",
      entityId: data.user.id,
      changes: { passwordSetupAt: now.toISOString() },
      metadata: { source: "password-setup" },
    });
    return { ok: true };
  });
}
