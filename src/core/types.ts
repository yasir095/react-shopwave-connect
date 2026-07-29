/**
 * Shared API envelope types.
 *
 * Preserved exactly from the original `model/message.ts` so existing
 * response handling keeps working.
 */

export interface ErrorMessage {
  id: number;
  title: string;
  details: string;
  moreInfo: string;
}

export interface SuccessMessage {
  id: number;
  title: string;
  details: string;
}

export interface MessageInfo {
  errors: {
    [key: number]: ErrorMessage;
  };
  success: {
    [key: number]: SuccessMessage;
  };
}

export interface apiResponse {
  message: MessageInfo;
  codeBaseVersion: number;
  executionTime_milliSeconds: number;
}
