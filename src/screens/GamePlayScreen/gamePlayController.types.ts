import type { TrickSelection } from "../../constants/tricks";
import type { GameDoc } from "../../services/games";
import type { Dispute } from "../../services/disputes";
import type { UploadProgress as UploadProgressData } from "../../services/storage";
import type { UserProfile } from "../../services/users";
import type { CommunityDisputeState } from "./useCommunityDispute";

/** Everything GamePlayScreen renders from; built by useGamePlayController. */
export interface GamePlayController {
  game: GameDoc;
  profile: UserProfile;

  trickName: string;
  setTrickName: (value: string) => void;
  trickPickerEnabled: boolean;
  trickSelection: TrickSelection | null;
  setTrickSelection: (selection: TrickSelection | null) => void;
  trimmedTrickName: string;
  showRecorder: boolean;

  videoBlob: Blob | null;
  videoRecorded: boolean;
  handleRecorded: (blob: Blob | null) => void;

  submitting: boolean;
  error: string;
  dismissError: () => void;
  uploadProgress: UploadProgressData | null;

  setterAction: "landed" | "missed" | null;
  matcherLanded: boolean | null;

  isPlayer: boolean;
  isJudge: boolean;
  judgeActive: boolean;
  isSetter: boolean;
  isMatcher: boolean;
  isDisputeReviewer: boolean;
  isSetTrickReviewer: boolean;
  isJudgeInvitePending: boolean;
  /** Setter of a frozen landed claim — sees Accept / Dispute (pendingReview). */
  isPendingReviewSetter: boolean;
  /** Claimer waiting on the setter's accept/dispute decision (pendingReview). */
  isPendingReviewMatcher: boolean;
  /** Either player while the dispute is out to the community (communityReview). */
  isCommunityReview: boolean;
  /** True in any frozen review phase — routes off the plain waiting screen. */
  isInReview: boolean;
  communityDispute: Dispute | null;
  communityDisputeState: CommunityDisputeState;
  /** Gate for the Dispute affordance — false once the claim can't be disputed. */
  canDispute: boolean;

  opponentName: string;
  opponentUid: string;
  opponentIsPro: boolean | undefined;
  setterUsername: string;
  setterIsPro: boolean | undefined;
  matcherUsername: string;

  myLetters: number;
  theirLetters: number;
  deadline: number;

  submitSetterTrick: (blob: Blob | null) => Promise<void>;
  submitSetterMissed: () => Promise<void>;
  submitMatchWithCall: (landed: boolean) => Promise<void>;

  disputeSubmitting: boolean;
  lastDisputeAction: boolean | null;
  handleResolveDispute: (accept: boolean) => Promise<void>;

  setReviewSubmitting: boolean;
  lastSetReviewAction: boolean | null;
  handleRuleSetTrick: (clean: boolean) => Promise<void>;

  callBSSubmitting: boolean;
  handleCallBS: () => Promise<void>;

  reviewSubmitting: boolean;
  lastReviewAction: "accept" | "dispute" | null;
  handleAcceptLanded: () => Promise<void>;
  handleRaiseDispute: () => Promise<void>;

  judgeActionSubmitting: boolean;
  handleJudgeAccept: () => Promise<void>;
  handleJudgeDecline: () => Promise<void>;

  showReport: boolean;
  openReport: () => void;
  closeReport: () => void;
  reported: boolean;
  markReported: () => void;
}
