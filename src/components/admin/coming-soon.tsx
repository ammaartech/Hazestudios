import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "./page-header";

export function ComingSoon({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div>
      <PageHeader title={title} />
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Construction className="size-6 text-muted-foreground" />
          </span>
          <div className="space-y-1">
            <p className="font-semibold">{title} is on the roadmap</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              {description}
            </p>
          </div>
          <Badge variant="secondary">Coming in {phase}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
