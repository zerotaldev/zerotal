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
 * const ok     = await TwoFactor.verifyCode(user.twoFactorSecret, inputCode);
 * const codes  = await TwoFactor.generateRecoveryCodes();
 */
export const TwoFactor = createFacade("two_factor");
