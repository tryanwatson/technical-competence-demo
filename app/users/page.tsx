import { sql } from "../db";

interface User {
  id: number;
  name: string;
  phone_number: string;
  tech_competence: boolean;
}

export default async function UsersPage() {
  const users = (await sql`SELECT * FROM users`) as User[];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold text-foreground">Users</h1>
      {users.length === 0 ? (
        <p className="text-foreground/50">No users found.</p>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-foreground/20">
              <th className="py-2 pr-4 font-semibold text-foreground/70">ID</th>
              <th className="py-2 pr-4 font-semibold text-foreground/70">Name</th>
              <th className="py-2 pr-4 font-semibold text-foreground/70">Phone Number</th>
              <th className="py-2 font-semibold text-foreground/70">Tech Competence</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-foreground/10">
                <td className="py-2 pr-4 text-foreground/60">{user.id}</td>
                <td className="py-2 pr-4 text-foreground">{user.name}</td>
                <td className="py-2 pr-4 text-foreground/60">{user.phone_number}</td>
                <td className="py-2 text-foreground/60">{user.tech_competence ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
