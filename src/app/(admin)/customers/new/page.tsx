import { PageHeader } from "@/components/admin/page-header";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Add customer" };

export default function NewCustomerPage() {
  return (
    <div>
      <PageHeader
        title="Add customer"
        backHref="/customers"
        backLabel="Customers"
      />
      <CustomerForm
        initial={{
          first_name: "",
          last_name: "",
          email: "",
          phone: "",
          notes: "",
          tags: [],
          accepts_marketing: false,
          default_address: {},
        }}
      />
    </div>
  );
}
