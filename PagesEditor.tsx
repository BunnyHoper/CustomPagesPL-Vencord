/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { DeleteIcon } from "@components/Icons";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { TextInput } from "@webpack/common";

import { cl, dropFrame, Page, PageLogo, pageUrl, settings } from ".";

function newId() {
    return Math.random().toString(36).slice(2, 8);
}

function urlError(value: string) {
    if (value.trim() === "" || pageUrl(value) !== null) return null;
    return "Use an http or https URL";
}

// Every edit replaces the array so settings.use() subscribers re-render. Items are copied
// to plain objects: the store hands out proxies, which can't be cloned when settings sync.
function updatePages(change: (pages: Page[]) => Page[]) {
    const plain = settings.store.pages.map(({ id, name, url, icon }) => ({ id, name, url, icon }));
    settings.store.pages = change(plain);
}

function setField(id: string, field: keyof Omit<Page, "id">, value: string) {
    updatePages(pages => pages.map(p => p.id === id ? { ...p, [field]: value } : p));
}

function move(index: number, by: -1 | 1) {
    updatePages(pages => {
        const target = index + by;
        if (target < 0 || target >= pages.length) return pages;
        [pages[index], pages[target]] = [pages[target], pages[index]];
        return pages;
    });
}

function remove(id: string) {
    dropFrame(id);
    updatePages(pages => pages.filter(p => p.id !== id));
}

function Field({ label, value, placeholder, error, onChange }: {
    label: string;
    value: string;
    placeholder: string;
    error?: string | null;
    onChange(value: string): void;
}) {
    return (
        <div className={cl("field")}>
            <BaseText size="xs" weight="semibold">{label}</BaseText>
            <TextInput value={value} placeholder={placeholder} onChange={onChange} error={error ?? undefined} />
        </div>
    );
}

export function PagesEditor() {
    const { pages } = settings.use(["pages"]);

    return (
        <section className={Margins.top8}>
            <BaseText size="md" weight="semibold">Pages</BaseText>
            <Paragraph size="sm" className={Margins.top8}>
                After adding a page or changing its URL or logo, press Ctrl+R once so Discord allows it. Pages without a custom logo use the website's own, saved once and reused. Right-click any page icon to come back here.
            </Paragraph>

            <Flex flexDirection="column" gap="0.75em" className={Margins.top8}>
                {pages.map((page, i) => (
                    <Card key={page.id} className={cl("card")}>
                        <div className={cl("card-head")}>
                            <span className={cl("card-logo")}><PageLogo page={page} /></span>
                            <BaseText size="md" weight="medium">{page.name || "Untitled page"}</BaseText>
                            <div className={cl("card-actions")}>
                                <Button variant="secondary" size="small" disabled={i === 0} onClick={() => move(i, -1)}>▲</Button>
                                <Button variant="secondary" size="small" disabled={i === pages.length - 1} onClick={() => move(i, 1)}>▼</Button>
                                <Button variant="dangerSecondary" size="iconOnly" onClick={() => remove(page.id)}>
                                    <DeleteIcon aria-label="Delete page" width={20} height={20} />
                                </Button>
                            </div>
                        </div>
                        <Field label="Name" value={page.name} placeholder="My page" onChange={v => setField(page.id, "name", v)} />
                        <Field label="URL" value={page.url} placeholder="https://" error={urlError(page.url)} onChange={v => setField(page.id, "url", v)} />
                        <Field label="Custom logo URL (optional — blank = the website's own logo)" value={page.icon} placeholder="https://…/logo.png" error={urlError(page.icon)} onChange={v => setField(page.id, "icon", v)} />
                    </Card>
                ))}

                <Button onClick={() => updatePages(p => [...p, { id: newId(), name: "New page", url: "", icon: "" }])}>
                    Add page
                </Button>
            </Flex>
        </section>
    );
}
