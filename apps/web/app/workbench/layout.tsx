import { Workbench } from "../components/workbench";

export default function WorkbenchLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Workbench />
      {children}
    </>
  );
}
