import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { PageHeader } from "../../Components/PageHeader";
import { ProjectForm } from "../../Components/ProjectForm";

interface Props {
  title: string;
}

function CreateProject({ title }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl">
        <PageHeader title="New project" back={{ href: route("projects"), label: "Projects" }} />
        <ProjectForm />
      </div>
    </>
  );
}

CreateProject.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default CreateProject;
