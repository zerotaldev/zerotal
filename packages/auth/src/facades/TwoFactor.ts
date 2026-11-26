import { createFacade } from "@zerotal/core";
import type { TwoFactorService } from "../TwoFactorService.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    two_factor: TwoFactorService;
  }
}

/**
 * TwoFactor facade — access the TwoFactorService from anywhere.
 *
 * @example
 * import { TwoFactor } from '@zerotal/auth';
 *
 * const secret = TwoFactor.generateSecret();
 * const svg    = TwoFactor.getQrCodeSvg(user.email, secret); // inline this
 * const uri    = TwoFactor.getQrCodeUrl(user.email, secret); // or link to it
 * // Pass the last accepted time step, so a code can't be used twice:
 * const check  = TwoFactor.verifyCodeWithCounter(user.twoFactorSecret, inputCode, user.twoFactorLastCounter);
 * if (check.valid) await user.update({ twoFactorLastCounter: check.counter });
 * const codes  = TwoFactor.generateRecoveryCodes();
 */
export const TwoFactor = createFacade("two_factor");
