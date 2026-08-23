import type { WalletTransaction } from "@shared/schema";
import type { User } from "@shared/models/auth";

export interface ManualPaymentDependencies {
  credit: () => Promise<WalletTransaction | undefined>;
  getUser: () => Promise<User | undefined>;
  getBalance: () => Promise<number>;
  getBranding: () => Promise<unknown>;
  sendConfirmation: (input: {
    email: string;
    firstName: string;
    amountCents: number;
    description: string;
    balanceCents: number;
    branding: unknown;
  }) => Promise<unknown>;
}

export async function executeManualPaymentForOrganization(
  input: { amountCents: number; description: string },
  dependencies: ManualPaymentDependencies,
): Promise<WalletTransaction | undefined> {
  const transaction = await dependencies.credit();
  if (!transaction) return undefined;

  const user = await dependencies.getUser();
  if (user?.email) {
    const [balanceCents, branding] = await Promise.all([
      dependencies.getBalance(),
      dependencies.getBranding(),
    ]);
    await dependencies.sendConfirmation({
      email: user.email,
      firstName: user.firstName || "Client",
      amountCents: input.amountCents,
      description: input.description,
      balanceCents,
      branding,
    }).catch(() => undefined);
  }

  return transaction;
}
