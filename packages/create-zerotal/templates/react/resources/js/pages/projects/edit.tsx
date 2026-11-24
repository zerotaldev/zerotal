import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { PageHeader } from "../../Components/PageHeader";
import { ProjectForm } from "../../Components/ProjectForm";
import type { Project } from "../../types";

interface Props {
  title: string;
  project: Project;
}

function EditProject({ title, project }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl">
        <PageHeader title={project.name} back={{ href: route("projects"), label: "Projects" }} />
        <ProjectForm project={project} />
      </div>
    </>
  );
}

EditProject.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default EditProject;
