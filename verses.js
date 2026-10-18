// Kjende bibelvers (berre tilvisingar, norsk versnummerering). Teksten les ein på bibel.no,
// eller frå versbanken der medlemene sjølve skriv inn vers dei likar.
window.DAILY_VERSES = [
  ['JHN', 3, '16'], ['PSA', 23, '1–3'], ['ROM', 8, '28'], ['PHP', 4, '13'], ['ISA', 41, '10'],
  ['JER', 29, '11'], ['MAT', 11, '28–30'], ['PRO', 3, '5–6'], ['JOS', 1, '9'], ['PSA', 46, '2'],
  ['ROM', 12, '2'], ['2CO', 5, '17'], ['GAL', 2, '20'], ['EPH', 2, '8–9'], ['PHP', 4, '6–7'],
  ['HEB', 11, '1'], ['1JN', 4, '19'], ['1CO', 13, '4–7'], ['MAT', 5, '14–16'], ['MAT', 6, '33'],
  ['MAT', 28, '20'], ['JHN', 14, '6'], ['JHN', 15, '5'], ['JHN', 11, '25'], ['JHN', 8, '12'],
  ['ROM', 5, '8'], ['ROM', 10, '9'], ['ROM', 15, '13'], ['PSA', 121, '1–2'], ['PSA', 119, '105'],
  ['PSA', 139, '14'], ['PSA', 37, '5'], ['PSA', 51, '12'], ['ISA', 40, '31'], ['ISA', 53, '5'],
  ['LAM', 3, '22–23'], ['MIC', 6, '8'], ['ZEP', 3, '17'], ['NUM', 6, '24–26'], ['DEU', 31, '8'],
  ['1PE', 5, '7'], ['JAS', 1, '5'], ['HEB', 13, '8'], ['HEB', 12, '1–2'], ['2TI', 1, '7'],
  ['1TH', 5, '16–18'], ['COL', 3, '23'], ['EPH', 6, '10'], ['MAT', 7, '7'], ['LUK', 1, '37'],
  ['LUK', 19, '10'], ['ACT', 1, '8'], ['REV', 21, '4'], ['REV', 3, '20'], ['GEN', 1, '1'],
  ['EXO', 14, '14'], ['PSA', 103, '2'], ['PRO', 16, '3'], ['ECC', 3, '1'], ['MRK', 10, '27'],
].map(([book, ch, verses]) => ({ book, ch_from: ch, ch_to: ch, verses }));
