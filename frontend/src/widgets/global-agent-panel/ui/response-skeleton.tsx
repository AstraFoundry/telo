import { copy } from "shared/config/copy";
import { Skeleton, SkeletonGroup, TextShimmer } from "shared/ui";

interface ResponseSkeletonProps {
  /** Latest activity step from the run, shown in place of the default label. */
  readonly activity: string | null;
}

/**
 * Stands in for the reply until the first token streams. The bars are the
 * shape of a short paragraph so the answer drops into a slot that already
 * exists instead of pushing the transcript when it starts; the shimmer
 * carries the one piece of information the run can offer — what it is doing.
 */
export function ResponseSkeleton({ activity }: ResponseSkeletonProps) {
  return (
    <SkeletonGroup
      label={activity ?? copy.agentThinking}
      className="flex w-full flex-col gap-2.5"
    >
      {/* The group's label already announces it; the visible copy is decorative. */}
      <span aria-hidden="true" className="flex">
        <TextShimmer
          as="span"
          duration={1.8}
          className="text-xs font-medium text-muted-foreground"
        >
          {activity ?? copy.agentThinking}
        </TextShimmer>
      </span>
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3.5 w-3/5" />
      <Skeleton className="h-3.5 w-2/5" />
    </SkeletonGroup>
  );
}
