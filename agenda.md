## Start

```shell
yarn db
```

Run `Author.test.ts`, watch it work

## Add a new entity, `BookReview`

```shell
yarn pg-new-migration "add book reviews"
yarn db
```

```ts
createEntityTable(b, "book_reviews", {
  book_id: foreignKey("books", { notNull: true }),
  rating: { type: "integer", notNull: true },
});
```

```shell
yarn redb
```

## Add a test that uses `BookReview`

```ts
describe("BookReview", () => {
  it.withCtx("can be created", async ({ em }) => {
    const br = newBookReview(em);
    await em.flush();
  });
});
```

## Calculate `Author.numberOfBookReviews`

- Start with await heavy code
- Show that an N+1 doesn't happen
  - dataloader, Rails

```ts
import { numberOfQueries, queries } from "src/setupTests";

class Author {
  async numberOfReviews(): Promise<number> {
    const books = await this.books.load();
    const counts = await Promise.all(
      books.map(async (b) => {
        const reviews = await b.reviews.load();
        return reviews.length;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
}

it.withCtx("can count its number of reviews", async ({ em }) => {
  // Given an author with 3 books each with 2 reviews
  const a = newAuthor(em, {
    books: [{ reviews: [{}, {}] }, { reviews: [{}, {}] }, { reviews: [{}, {}] }],
  });
  await em.flush();
  // Then there should be 6 reviews
  expect(await a2.numberOfReviews()).toBe(6);
  expect(queries).toEqual([]);
});
```

## Show collections are cached

- Use a new EM to test the unloaded state
  - Endpoint tests should use clean EMs

```ts
it.withCtx("can count its number of reviews", async ({ em }) => {
  // Given an author with 3 books with 2 reviews each
  const a = newAuthor(em, {
    books: [{ reviews: [{}, {}] }, { reviews: [{}, {}] }, { reviews: [{}, {}] }],
  });
  await em.flush();
  // When we count the number of reviews
  expect(await a.numberOfReviews()).toBe(6);
  // Then we made 0 queries
  expect(queries).toEqual([]);
});
```

## Show no N+1s

- Use a new EM to test the unloaded state
  - Endpoint tests should use clean EMs

```ts
it.withCtx("can count its number of reviews", async ({ em }) => {
  // Given an author with 3 books with 2 reviews each
  const a = newAuthor(em, {
    books: [{ reviews: [{}, {}] }, { reviews: [{}, {}] }, { reviews: [{}, {}] }],
  });
  await em.flush();
  // When we count the number of reviews in a fresh em (tests should not regularly do this, ugly/tedious)
  const em2 = await newEntityManager();
  const a2 = await em2.load(Author, a.idOrFail);
  expect(await a2.numberOfReviews()).toBe(6);
  // Then we made 3 queries
  expect(queries).toEqual([
    `select "a".*, "a".id as id from "authors" as "a" where "a"."id" in ($1) order by "a"."id" ASC, "a"."id" asc limit $2`,
    `select "b".*, "b".id as id from "books" as "b" where "b"."author_id" in ($1) order by "b"."id" asc limit $2`,
    `select "br".*, "br".id as id from "book_reviews" as "br" where "br"."book_id" in ($1, $2, $3) order by "br"."id" asc limit $4`,
  ]);
});
```

## Add another entity to make the async even worse

```shell
yarn pg-new-migration "add reviewers"
```

```ts
// Keep track of who is making reviews
createEntityTable(b, "reviewers", {
  name: { type: "text", notNull: true },
  age: { type: "integer", notNull: true },
});
// Assume we don't have any reviews in the database yet
addColumns(b, "book_reviews", {
  reviewer_id: foreignKey("reviewers", { notNull: true }),
});
```

```ts
class Author {
  async numberOfReviews(): Promise<number> {
    const books = await this.books.load();
    const counts = await Promise.all(
      books.map(async (b) => {
        const reviews = await b.reviews.load();
        const publicReviews = await Promise.all(
          reviews.map(async (review) => {
            const reviewer = await review.reviewer.load();
            if (reviewer.age > 18) {
              return review;
            }
            return undefined;
          }),
        );
        return publicReviews.filter((r) => !!r).length;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
}
```

## Refactor `age` logic to be `BookReview.isPublic` method

```ts
export class BookReview extends BookReviewCodegen {
  async isPublic(): Promise<boolean> {
    const reviewer = await this.reviewer.load();
    return reviewer.age > 18;
  }
}
```

```ts
export class Author extends AuthorCodegen {
  async numberOfReviews(): Promise<number> {
    const books = await this.books.load();
    const counts = await Promise.all(
      books.map(async (b) => {
        const reviews = await b.reviews.load();
        const publicReviews = await Promise.all(
          reviews.map(async (review) => {
            return (await review.isPublic()) ? review : undefined;
          }),
        );
        return publicReviews.filter((r) => !!r).length;
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }
}
```

- Observe still no N+1s

## Refactor `Author.numberOfReviews` to use populate hints

- Show simplicity of `get`

```ts
export class Author extends AuthorCodegen {
  async numberOfReviews2(): Promise<number> {
    const author = await this.populate({ books: { reviews: "reviewer" } });
    return author.books.get.flatMap((b) => b.reviews.get.filter((r) => r.reviewer.get.age > 18)).length;
  }
}
```

## Refactor `Author.numberOfReviews` to use `isPublic` async property

- Show simplicity of `get`

```ts
export class BookReview extends BookReviewCodegen {
  readonly isPublic: AsyncProperty<BookReview, boolean> = hasAsyncProperty("reviewer", (br) => {
    return br.reviewer.get.age > 18;
  });
}

export class Author extends AuthorCodegen {
  async numberOfReviews3(): Promise<number> {
    const author = await this.populate({ books: { reviews: "reviewer" } });
    return author.books.get.flatMap((b) => b.reviews.get.filter((r) => r.reviewer.get.age > 18)).length;
  }
}
```

## Refactor `Author.numberOfReviews` to itself be an async property

```ts
class Author {
  readonly numberOfReviews4: AsyncProperty<Author, number> = hasAsyncProperty(
    { books: { reviews: "isPublic2" } },
    (a) => {
      return a.books.get.flatMap((b) => b.reviews.get.filter((r) => r.isPublic2.get)).length;
    },
  );
}
```

## Add `Author.reviews` has many through

```ts
class Author {
  readonly reviews: Collection<Author, BookReview> = hasManyThrough((a) => a.books.reviews);
}
```

## Add `Author.publicReviews` has many derived

```ts
class Author {
  readonly publicReviews: Collection<Author, BookReview> = hasManyDerived(
    { books: { reviews: "isPublic2" } },
    {
      get(a) {
        return a.books.get.flatMap((b) => b.reviews.get.filter((r) => r.isPublic2.get));
      },
    },
  );
}
```

## Change `Author.numberOfReviews` to a persisted field

```ts
export async function up(b: MigrationBuilder): Promise<void> {
  // Given the datalake easy access to our business logic
  addColumns(b, "authors", {
    number_of_reviews: { type: "int", notNull: true, default: 0 },
  });
}
```

```json
{
  "Author": { "fields": { "numberOfReviews": { "derived": "async" } }, "tag": "a" }
}
```

```ts
class Author {
  readonly numberOfReviews: PersistedAsyncProperty<Author, number> = hasPersistedAsyncProperty(
    "numberOfReviews",
    { books: { reviews: "isPublic2" } },
    (a) => {
      return a.books.get.flatMap((b) => b.reviews.get.filter((r) => r.isPublic2.get)).length;
    },
  );
}

class BookReview {
  readonly isPublic2: AsyncProperty<BookReview, boolean> = hasReactiveAsyncProperty({ reviewer: "age" }, (br) => {
    return br.reviewer.get.age > 18;
  });
}
```

```ts
expect((await select("authors"))[0]).toMatchObject({
  id: 1,
  first_name: "firstName",
  number_of_reviews: 6,
});
```

## GraphQL Scaffolding

- Add `Query.authors`
- Add `BookReview.isPublic`
- Call `saveBookReview`
- Add `Author.publicReviews`
