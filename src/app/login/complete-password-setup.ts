"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createClient } from "@/lib/auth/server";
import { auditLogs, getDatabase, users } from "@/lib/db";

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
