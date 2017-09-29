import * as Bluebird from 'bluebird'
import * as path from 'path'
import { SnippetCompiler, SnippetCompilationResult } from './src/SnippetCompiler'

const DEFAULT_FILES = ['README.md']

const wrapIfString = (arrayOrString: string[] | string) => {
  if (Array.isArray(arrayOrString)) {
    return arrayOrString
  } else {
    return [arrayOrString]
  }
}

export function compileSnippets (markdownFileOrFiles: string | string[] = DEFAULT_FILES): Bluebird<SnippetCompilationResult[]> {
  const workingDirectory = path.join(process.cwd(), 'compiled-docs')
  const compiler = new SnippetCompiler(workingDirectory)
  return Bluebird.resolve(markdownFileOrFiles)
    .then(wrapIfString)
    .then((fileArray) => compiler.compileSnippets(fileArray))
}
