import { CommentThread } from "@/components/avantprojecte/comment-thread";
import { Card } from "@/components/ui";
import { projectPeople } from "@/lib/avantprojecte-data";
import { generalMessages } from "@/lib/avantprojecte-workspace";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, mentionable, type TabProps } from "./shared";

// Conversa general del projecte amb el client (i notes internes de l'equip).
export async function MessagesTab({ projectId, profile }: TabProps) {
  const { T, messages } = clientTexts(profile);
  const supabase = await createClient();
  const people = await projectPeople(supabase, projectId);
  const general = await generalMessages(supabase, projectId, people, profile.locale);
  return (
    <Card title={T.portal.sections.missatges}>
      <CommentThread projectId={projectId} target={{}} comments={general} canInternal canResolve
        participants={mentionable(people, profile.id)} texts={T.thread} messages={messages} />
    </Card>
  );
}
