import { redirect } from "next/navigation";

export default async function TraineeIndexPage({ params }: { params: { id: string } }) {
  redirect(`/trainee/${params.id}/dashboard`);
}
