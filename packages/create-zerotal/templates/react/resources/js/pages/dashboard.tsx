import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../Layouts/AppLayout";
import { ButtonLink } from "../Components/Button";
import { EmptyState } from "../Components/EmptyState";
import { FolderIcon } from "../Components/Icons";
import { PageHeader } from "../Components/PageHeader";

interface Props {
  title: string;
  greeting: string;
}

function Dashboard({ title, greeting }: Props) {
  return (
    <>
      <Head title={title} />

      <PageHeader title={greeting} description="Here is what is happening in your account." />

      <EmptyState
        icon={FolderIcon}
        title="Nothing here yet"
        description="This is where your work will show up."
        action={<ButtonLink href={route("settings")}>Review your settings</ButtonLink>}
      />
    </>
  );
}

Dashboard.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default Dashboard;
