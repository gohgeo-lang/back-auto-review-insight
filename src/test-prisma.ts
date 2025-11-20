import { prisma } from "./lib/prisma";

async function main() {
  const user = await prisma.user.create({
    data: {
      email: "test@test.com",
      password: "1234",
      storeName: "테스트매장",
    },
  });

  console.log("생성된 유저:", user);
}

main();
